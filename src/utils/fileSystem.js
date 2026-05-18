const FILE_SYSTEM_STORAGE_KEYS = Object.freeze({
  folderAuthState: 'folderAuthState',
  folderDisplayName: 'folderDisplayName',
  folderChosenAt: 'folderChosenAt',
  folderLastVerifiedAt: 'folderLastVerifiedAt',
  folderLastFailureReason: 'folderLastFailureReason',
  folderVersion: 'folderVersion',
  isAuthorized: 'isAuthorized',
  savePath: 'savePath'
});

const FOLDER_STATE_DEFAULTS = Object.freeze({
  folderAuthState: 'missing',
  folderDisplayName: '',
  folderChosenAt: '',
  folderLastVerifiedAt: '',
  folderLastFailureReason: '',
  folderVersion: 2
});

function hasWindow() {
  return typeof window !== 'undefined';
}

const FileSystemManager = {
  rootHandle: null,
  folderState: null,
  backupFolderName: 'ChatGPT-Backup',
  dbName: 'ChatGPTSaverDB',
  storeName: 'fileHandles',

  _now() {
    return new Date().toISOString();
  },

  _normalizeFolderState(raw = {}) {
    return {
      folderAuthState: String(raw.folderAuthState || raw.authState || FOLDER_STATE_DEFAULTS.folderAuthState),
      folderDisplayName: String(raw.folderDisplayName || raw.savePath || FOLDER_STATE_DEFAULTS.folderDisplayName),
      folderChosenAt: String(raw.folderChosenAt || FOLDER_STATE_DEFAULTS.folderChosenAt),
      folderLastVerifiedAt: String(raw.folderLastVerifiedAt || FOLDER_STATE_DEFAULTS.folderLastVerifiedAt),
      folderLastFailureReason: String(raw.folderLastFailureReason || FOLDER_STATE_DEFAULTS.folderLastFailureReason),
      folderVersion: Number(raw.folderVersion || FOLDER_STATE_DEFAULTS.folderVersion) || FOLDER_STATE_DEFAULTS.folderVersion
    };
  },

  async _storageGet(keys) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.get) {
      return Array.isArray(keys) ? {} : { ...(keys || {}) };
    }
    return chrome.storage.local.get(keys);
  },

  async _storageSet(value) {
    if (typeof chrome === 'undefined' || !chrome.storage?.local?.set) return;
    await chrome.storage.local.set(value);
  },

  async getFolderState() {
    if (this.folderState) return this.folderState;
    const state = await this._storageGet(Object.values(FILE_SYSTEM_STORAGE_KEYS));
    this.folderState = this._normalizeFolderState(state || {});
    return this.folderState;
  },

  async persistFolderState(partial = {}) {
    const prev = await this.getFolderState();
    const next = this._normalizeFolderState({ ...prev, ...partial });
    this.folderState = next;
    await this._storageSet({
      [FILE_SYSTEM_STORAGE_KEYS.folderAuthState]: next.folderAuthState,
      [FILE_SYSTEM_STORAGE_KEYS.folderDisplayName]: next.folderDisplayName,
      [FILE_SYSTEM_STORAGE_KEYS.folderChosenAt]: next.folderChosenAt,
      [FILE_SYSTEM_STORAGE_KEYS.folderLastVerifiedAt]: next.folderLastVerifiedAt,
      [FILE_SYSTEM_STORAGE_KEYS.folderLastFailureReason]: next.folderLastFailureReason,
      [FILE_SYSTEM_STORAGE_KEYS.folderVersion]: next.folderVersion,
      [FILE_SYSTEM_STORAGE_KEYS.isAuthorized]: next.folderAuthState === 'granted',
      [FILE_SYSTEM_STORAGE_KEYS.savePath]: next.folderAuthState === 'granted' ? next.folderDisplayName : ''
    });
    return next;
  },

  async markFolderState(folderAuthState, extras = {}) {
    return this.persistFolderState({
      folderAuthState,
      folderDisplayName: String(extras.folderDisplayName || this.rootHandle?.name || this.folderState?.folderDisplayName || ''),
      folderChosenAt: String(extras.folderChosenAt || this.folderState?.folderChosenAt || (folderAuthState === 'granted' ? this._now() : '')),
      folderLastVerifiedAt: String(extras.folderLastVerifiedAt || (folderAuthState === 'granted' ? this._now() : this.folderState?.folderLastVerifiedAt || '')),
      folderLastFailureReason: String(extras.folderLastFailureReason || '')
    });
  },

  isFileSystemAccessSupported() {
    return hasWindow() && typeof window.showDirectoryPicker === 'function';
  },

  getUnsupportedReason() {
    if (!hasWindow()) return '当前环境不支持文件系统 API';
    if (!window.isSecureContext) return '当前页面不是安全上下文(HTTPS)，无法使用文件系统API';
    if (typeof window.showDirectoryPicker !== 'function') return '当前浏览器不支持文件系统API，请使用最新版Chrome/Edge浏览器';
    return null;
  },

  async saveHandleToIndexedDB(handle) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onerror = () => reject(request.error);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName);
      };
      request.onsuccess = (event) => {
        const db = event.target.result;
        const tx = db.transaction(this.storeName, 'readwrite');
        tx.objectStore(this.storeName).put(handle, 'rootHandle');
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
    });
  },

  async restoreHandleFromIndexedDB() {
    return new Promise((resolve) => {
      const request = indexedDB.open(this.dbName, 1);
      request.onerror = () => resolve(null);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this.storeName)) db.createObjectStore(this.storeName);
      };
      request.onsuccess = (event) => {
        const db = event.target.result;
        const tx = db.transaction(this.storeName, 'readonly');
        const getRequest = tx.objectStore(this.storeName).get('rootHandle');
        getRequest.onsuccess = () => resolve(getRequest.result || null);
        getRequest.onerror = () => resolve(null);
      };
    });
  },

  async clearSavedHandle({ clearFolderState = false, failureReason = '' } = {}) {
    this.rootHandle = null;
    await new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve();
        return;
      }
      const request = indexedDB.open(this.dbName, 1);
      request.onerror = () => resolve();
      request.onsuccess = (event) => {
        try {
          const db = event.target.result;
          const tx = db.transaction(this.storeName, 'readwrite');
          tx.objectStore(this.storeName).delete('rootHandle');
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      };
    });
    if (clearFolderState) {
      await this.markFolderState('missing', { folderLastFailureReason: failureReason || 'cleared' });
    }
  },

  async _verifyHandle(handle, { interactive = false } = {}) {
    if (!handle) return { valid: false, reason: 'missing' };
    let permission = 'prompt';
    try {
      permission = await handle.queryPermission({ mode: 'readwrite' });
    } catch {
      return { valid: false, reason: 'invalid_handle' };
    }
    if (permission !== 'granted' && interactive && typeof handle.requestPermission === 'function') {
      try {
        permission = await handle.requestPermission({ mode: 'readwrite' });
      } catch {
        permission = 'denied';
      }
    }
    if (permission !== 'granted') {
      // 'prompt' 意味着 handle 仍然有效（浏览器重启后的常见状态），只是缺少用户授权
      // 这里把 handle 一并返回，调用方可以保留 IndexedDB 记录，下次 interactive 调用走 requestPermission
      return {
        valid: false,
        reason: permission === 'denied' ? 'denied' : 'permission_required',
        handle
      };
    }
    try {
      await handle.getDirectoryHandle(this.backupFolderName, { create: true });
      return { valid: true, handle };
    } catch {
      return { valid: false, reason: 'folder_inaccessible' };
    }
  },

  _isHandleStillSalvageable(reason) {
    return reason === 'permission_required';
  },

  async requestFolderAccess() {
    if (!this.isFileSystemAccessSupported()) {
      const reason = this.getUnsupportedReason();
      const folderState = await this.markFolderState('unsupported', { folderLastFailureReason: reason || 'unsupported' });
      return { success: false, error: reason, unsupported: true, folderState };
    }
    try {
      const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents' });
      await handle.getDirectoryHandle(this.backupFolderName, { create: true });
      await this.saveHandleToIndexedDB(handle);
      this.rootHandle = handle;
      const folderState = await this.markFolderState('granted', {
        folderDisplayName: handle.name,
        folderChosenAt: this._now(),
        folderLastVerifiedAt: this._now(),
        folderLastFailureReason: ''
      });
      return { success: true, folderName: handle.name, folderState };
    } catch (error) {
      const folderState = await this.markFolderState(error?.name === 'AbortError' ? 'denied' : 'stale', {
        folderLastFailureReason: error?.name === 'AbortError' ? 'user_cancelled' : (error?.message || 'request_failed')
      });
      return { success: false, error: error?.name === 'AbortError' ? '用户取消了选择' : (error?.message || '选择文件夹失败'), folderState };
    }
  },

  async ensureFolderReady(options = {}) {
    const interactive = options.interactive === true;
    const reason = String(options.reason || 'unknown');
    if (!this.isFileSystemAccessSupported()) {
      const unsupportedReason = this.getUnsupportedReason();
      const folderState = await this.markFolderState('unsupported', { folderLastFailureReason: unsupportedReason || `unsupported:${reason}` });
      return { ready: false, reason: 'unsupported', error: unsupportedReason, folderState };
    }
    const loadedState = await this.getFolderState();
    if (this.rootHandle) {
      const checked = await this._verifyHandle(this.rootHandle, { interactive });
      if (checked.valid) {
        const folderState = await this.markFolderState('granted', {
          folderDisplayName: this.rootHandle.name,
          folderChosenAt: loadedState.folderChosenAt || this._now(),
          folderLastVerifiedAt: this._now(),
          folderLastFailureReason: ''
        });
        return { ready: true, folderState, handle: this.rootHandle };
      }
      const salvageable = this._isHandleStillSalvageable(checked.reason);
      if (!salvageable) {
        this.rootHandle = null;
      }
      if (checked.reason === 'invalid_handle' || checked.reason === 'folder_inaccessible') {
        await this.clearSavedHandle();
      }
      await this.markFolderState(checked.reason === 'denied' ? 'denied' : 'stale', { folderLastFailureReason: checked.reason });
    }

    const restored = await this.restoreHandleFromIndexedDB();
    if (restored) {
      const checked = await this._verifyHandle(restored, { interactive });
      if (checked.valid) {
        this.rootHandle = restored;
        const folderState = await this.markFolderState('granted', {
          folderDisplayName: restored.name,
          folderChosenAt: loadedState.folderChosenAt || this._now(),
          folderLastVerifiedAt: this._now(),
          folderLastFailureReason: ''
        });
        return { ready: true, folderState, handle: restored };
      }
      // 修复：仅在 handle 真的失效（invalid/folder_inaccessible）时才清 IndexedDB。
      // 浏览器重启后权限会降为 'prompt'（permission_required），handle 本身还能用，
      // 这种情况下保留 IndexedDB 中的 handle，并把它记在 rootHandle 上供下次 interactive 重用。
      if (checked.reason === 'invalid_handle' || checked.reason === 'folder_inaccessible') {
        await this.clearSavedHandle();
      } else if (this._isHandleStillSalvageable(checked.reason)) {
        this.rootHandle = restored;
      }
      await this.markFolderState(checked.reason === 'denied' ? 'denied' : 'stale', {
        folderDisplayName: restored.name || loadedState.folderDisplayName,
        folderChosenAt: loadedState.folderChosenAt || this._now(),
        folderLastFailureReason: checked.reason
      });
    }

    if (interactive) {
      // 如果还有保留下来的 rootHandle（permission_required 路径），优先走 requestPermission
      // 而不是 showDirectoryPicker，让用户只需要点一次"允许"即可恢复
      if (this.rootHandle) {
        const recheck = await this._verifyHandle(this.rootHandle, { interactive: true });
        if (recheck.valid) {
          const folderState = await this.markFolderState('granted', {
            folderDisplayName: this.rootHandle.name,
            folderChosenAt: loadedState.folderChosenAt || this._now(),
            folderLastVerifiedAt: this._now(),
            folderLastFailureReason: ''
          });
          return { ready: true, folderState, handle: this.rootHandle };
        }
        if (recheck.reason === 'invalid_handle' || recheck.reason === 'folder_inaccessible') {
          this.rootHandle = null;
          await this.clearSavedHandle();
        }
      }
      const result = await this.requestFolderAccess();
      return { ready: result.success === true, reason: result.success ? 'granted' : 'interactive_failed', error: result.error || '', folderState: result.folderState };
    }

    // 不强行覆盖已有状态：如果前面已经把 folderAuthState 标到 'stale'/'denied'/'permission_required'，
    // 这里应当沿用，避免把刚记录下来的失败原因覆盖回 'missing'。
    const currentState = this.folderState || loadedState;
    const fallbackAuthState = currentState.folderDisplayName ? (currentState.folderAuthState || 'stale') : 'missing';
    const folderState = await this.markFolderState(fallbackAuthState, {
      folderDisplayName: currentState.folderDisplayName,
      folderLastFailureReason: currentState.folderLastFailureReason || loadedState.folderLastFailureReason || `ensure_failed:${reason}`
    });
    return { ready: false, reason: folderState.folderAuthState, error: '检测到未设置或已失效的保存文件夹', folderState };
  },

  /**
   * 仅尝试恢复 IndexedDB 中已保存 handle 的权限，不弹出 showDirectoryPicker。
   * 用于浏览器重启后第一次进入的场景，用户在 popup 点"恢复访问"按钮触发。
   */
  async restorePermission() {
    if (!this.isFileSystemAccessSupported()) {
      const reason = this.getUnsupportedReason();
      const folderState = await this.markFolderState('unsupported', { folderLastFailureReason: reason || 'unsupported' });
      return { success: false, error: reason, unsupported: true, folderState };
    }

    let handle = this.rootHandle;
    if (!handle) {
      handle = await this.restoreHandleFromIndexedDB();
    }
    if (!handle) {
      return { success: false, error: '尚未选择过保存文件夹', notFound: true };
    }

    const checked = await this._verifyHandle(handle, { interactive: true });
    if (checked.valid) {
      this.rootHandle = handle;
      const loadedState = await this.getFolderState();
      const folderState = await this.markFolderState('granted', {
        folderDisplayName: handle.name,
        folderChosenAt: loadedState.folderChosenAt || this._now(),
        folderLastVerifiedAt: this._now(),
        folderLastFailureReason: ''
      });
      return { success: true, folderName: handle.name, folderState };
    }

    if (checked.reason === 'invalid_handle' || checked.reason === 'folder_inaccessible') {
      this.rootHandle = null;
      await this.clearSavedHandle();
    }
    const folderState = await this.markFolderState(checked.reason === 'denied' ? 'denied' : 'stale', {
      folderDisplayName: handle.name,
      folderLastFailureReason: checked.reason
    });
    return { success: false, error: checked.reason === 'denied' ? '已拒绝授权' : '恢复访问失败，可能需要重新选择文件夹', folderState };
  },

  async tryRestoreAccess() {
    const result = await this.ensureFolderReady({ interactive: false, reason: 'restore' });
    return result.ready === true;
  },

  isAuthorized() {
    return this.rootHandle !== null;
  },

  async getBackupRootHandle() {
    const ready = await this.ensureFolderReady({ interactive: false, reason: 'get_backup_root' });
    if (!ready.ready || !this.rootHandle) return null;
    try {
      return await this.rootHandle.getDirectoryHandle(this.backupFolderName, { create: true });
    } catch {
      return null;
    }
  },

  sanitizeFileName(name) {
    const raw = String(name || '')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/[/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '');
    let sanitized = raw || 'untitled';
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(sanitized)) sanitized = `${sanitized}_`;
    return sanitized.substring(0, 100) || 'untitled';
  },

  getTimestamp() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hour = String(now.getHours()).padStart(2, '0');
    const minute = String(now.getMinutes()).padStart(2, '0');
    const second = String(now.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}_${hour}${minute}${second}`;
  },

  simpleHash(input) {
    const text = String(input || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return `h${(hash >>> 0).toString(16)}`;
  },

  extractMessageCountFromHtml(htmlContent) {
    const text = String(htmlContent || '');
    const patterns = [/data-msg-count\s*=\s*"(\d+)"/i, /消息数\s*[：:]\s*(\d+)/i, /共\s*(\d+)\s*条消息/i];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && Number.isFinite(Number(match[1]))) return Number(match[1]);
    }
    return null;
  },

  async readMessageCountFromJson(conversationFolder, sanitizedTitle) {
    try {
      const jsonFolder = await conversationFolder.getDirectoryHandle('json', { create: false });
      const file = await (await jsonFolder.getFileHandle(`${sanitizedTitle}.json`, { create: false })).getFile();
      const data = JSON.parse(await file.text());
      const count = Number(data?.messageCount);
      if (Number.isFinite(count) && count >= 0) return count;
      if (Array.isArray(data?.messages)) return data.messages.length;
      return null;
    } catch {
      return null;
    }
  },

  buildConversationUpdateMeta(meta = {}) {
    return {
      messageCount: Number(meta.messageCount || meta.currentMessageCount || 0) || 0,
      lastMessageDigest: String(meta.lastMessageDigest || ''),
      assetsDigest: String(meta.assetsDigest || '')
    };
  },

  async getOrCreateFolder(parentHandle, folderName) {
    return parentHandle.getDirectoryHandle(folderName, { create: true });
  },

  async readJsonFile(folderHandle, fileName, fallbackValue = null) {
    try {
      const fileHandle = await folderHandle.getFileHandle(fileName, { create: false });
      const file = await fileHandle.getFile();
      return JSON.parse(await file.text());
    } catch {
      return fallbackValue;
    }
  },

  _normalizeAssetEntry(kind, entry = {}) {
    return {
      kind,
      name: this.sanitizeFileName(entry.name || `${kind}-file`),
      mimeType: String(entry.mimeType || ''),
      size: Number(entry.size || 0) || 0,
      status: String(entry.status || 'saved'),
      savedPath: String(entry.savedPath || ''),
      source: String(entry.source || ''),
      messageId: String(entry.messageId || ''),
      collectedAt: String(entry.collectedAt || this._now()),
      error: String(entry.error || ''),
      sandboxPath: String(entry.sandboxPath || '')
    };
  },

  _assetKey(entry = {}) {
    return [entry.kind, entry.name, entry.savedPath, entry.messageId, entry.sandboxPath].map((item) => String(item || '')).join('::');
  },

  buildAssetsSummary(index = {}) {
    const uploads = Array.isArray(index.uploads) ? index.uploads : [];
    const generated = Array.isArray(index.generated) ? index.generated : [];
    const missingOriginalCount = uploads.concat(generated).filter((item) => item.status === 'missing_original').length;
    return {
      uploadCount: uploads.filter((item) => item.status === 'saved').length,
      generatedCount: generated.filter((item) => item.status === 'saved').length,
      missingOriginalCount,
      assetsDigest: this.simpleHash(JSON.stringify({
        uploads: uploads.map((item) => [item.name, item.status, item.savedPath, item.messageId]),
        generated: generated.map((item) => [item.name, item.status, item.savedPath, item.messageId, item.sandboxPath])
      }))
    };
  },

  async createConversationFolders(conversationTitle, workspaceName = null) {
    if (!this.rootHandle) throw new Error('未授权文件夹访问');
    const safeTitle = this.sanitizeFileName(conversationTitle);
    const backupRoot = await this.getOrCreateFolder(this.rootHandle, this.backupFolderName);
    let parentFolder = backupRoot;
    let safeWorkspace = '';
    if (workspaceName) {
      safeWorkspace = this.sanitizeFileName(workspaceName);
      parentFolder = await this.getOrCreateFolder(backupRoot, safeWorkspace);
    }
    const root = await this.getOrCreateFolder(parentFolder, safeTitle);
    return {
      root,
      html: await this.getOrCreateFolder(root, 'html'),
      md: await this.getOrCreateFolder(root, 'md'),
      pdf: await this.getOrCreateFolder(root, 'pdf'),
      json: await this.getOrCreateFolder(root, 'json'),
      context: await this.getOrCreateFolder(root, 'context'),
      uploads: await this.getOrCreateFolder(root, 'uploads'),
      generated: await this.getOrCreateFolder(root, 'generated'),
      meta: await this.getOrCreateFolder(root, 'meta'),
      title: safeTitle,
      folderName: safeTitle,
      workspaceName: safeWorkspace
    };
  },

  async loadAssetsIndex(conversationFolder, conversationTitle = '', workspaceName = '', conversationUrl = '') {
    const metaFolder = await this.getOrCreateFolder(conversationFolder, 'meta');
    const fallback = {
      version: '2.1',
      conversationTitle,
      workspace: workspaceName,
      conversationUrl,
      updatedAt: this._now(),
      uploads: [],
      generated: [],
      summary: { uploadCount: 0, generatedCount: 0, missingOriginalCount: 0, assetsDigest: '' }
    };
    return this.readJsonFile(metaFolder, 'assets.json', fallback);
  },

  async upsertAssetEntries(conversationTitle, workspaceName, conversationUrl, kind, entries = []) {
    const folders = await this.createConversationFolders(conversationTitle, workspaceName);
    const current = await this.loadAssetsIndex(folders.root, conversationTitle, workspaceName, conversationUrl);
    const key = kind === 'generated' ? 'generated' : 'uploads';
    const merged = new Map((current[key] || []).map((entry) => [this._assetKey(entry), this._normalizeAssetEntry(kind === 'generated' ? 'generated' : 'upload', entry)]));
    entries.forEach((entry) => {
      const normalized = this._normalizeAssetEntry(kind === 'generated' ? 'generated' : 'upload', entry);
      merged.set(this._assetKey(normalized), normalized);
    });
    current[key] = Array.from(merged.values());
    current.updatedAt = this._now();
    current.summary = this.buildAssetsSummary(current);
    await this.writeFile(folders.meta, 'assets.json', JSON.stringify(current, null, 2), 'application/json');
    return current;
  },

  async saveConversationContext(conversation, workspaceName, assetIndex = null) {
    if (!conversation?.title || !Array.isArray(conversation.messages) || conversation.messages.length === 0) return null;
    const folders = await this.createConversationFolders(conversation.title, workspaceName);
    const index = assetIndex || await this.loadAssetsIndex(folders.root, conversation.title, workspaceName, conversation.url || '');
    const assetsSummary = index.summary || this.buildAssetsSummary(index);
    const lastMessageDigest = this.simpleHash(JSON.stringify(conversation.messages.slice(-1).map((msg) => ({
      role: msg.role,
      textContent: msg.textContent || '',
      content: msg.content || ''
    }))));
    const payload = {
      version: '2.1',
      type: 'single',
      title: conversation.title,
      url: conversation.url || '',
      exportedAt: this._now(),
      messageCount: conversation.messages.length,
      workspace: workspaceName || '',
      lastMessageDigest,
      assetsDigest: assetsSummary.assetsDigest || '',
      assetsSummary,
      availableUploads: (index.uploads || []).filter((item) => item.status === 'saved').map((item) => item.name),
      availableGeneratedFiles: (index.generated || []).filter((item) => item.status === 'saved').map((item) => item.name),
      messages: conversation.messages.map((msg, index2) => ({ index: index2 + 1, role: msg.role, content: msg.textContent || '' }))
    };
    await this.writeFile(folders.context, `${folders.title}.json`, JSON.stringify(payload, null, 2), 'application/json');
    return payload;
  },

  async checkConversationNeedsUpdate(conversationTitle, workspaceName, currentMeta) {
    if (!this.rootHandle) return { needsUpdate: true, reason: 'no_handle', savedCount: 0 };
    const current = typeof currentMeta === 'number' ? this.buildConversationUpdateMeta({ messageCount: currentMeta }) : this.buildConversationUpdateMeta(currentMeta);
    try {
      const safeTitle = this.sanitizeFileName(conversationTitle);
      const backupRoot = await this.rootHandle.getDirectoryHandle(this.backupFolderName, { create: false });
      let parent = backupRoot;
      if (workspaceName) {
        try {
          parent = await backupRoot.getDirectoryHandle(this.sanitizeFileName(workspaceName), { create: false });
        } catch {
          return { needsUpdate: true, reason: 'new', savedCount: 0 };
        }
      }
      let conversationFolder;
      try {
        conversationFolder = await parent.getDirectoryHandle(safeTitle, { create: false });
      } catch {
        return { needsUpdate: true, reason: 'new', savedCount: 0 };
      }

      const contextFolder = await this.getOrCreateFolder(conversationFolder, 'context');
      const contextData = await this.readJsonFile(contextFolder, `${safeTitle}.json`, null);
      const assetsIndex = await this.loadAssetsIndex(conversationFolder, safeTitle, workspaceName || '', '');
      let savedCount = Number(contextData?.messageCount || 0) || 0;
      if (!savedCount) {
        savedCount = await this.readMessageCountFromJson(conversationFolder, safeTitle);
      }
      if (!savedCount) {
        try {
          const htmlFolder = await conversationFolder.getDirectoryHandle('html', { create: false });
          const file = await (await htmlFolder.getFileHandle(`${safeTitle}.html`, { create: false })).getFile();
          savedCount = this.extractMessageCountFromHtml(await file.text());
        } catch {
          savedCount = null;
        }
      }
      if (!Number.isFinite(savedCount)) return { needsUpdate: true, reason: 'no_count_marker', savedCount: 0 };
      if (current.messageCount !== savedCount) {
        return { needsUpdate: true, reason: current.messageCount > savedCount ? 'updated' : 'count_changed', savedCount, currentCount: current.messageCount };
      }
      const savedLastDigest = String(contextData?.lastMessageDigest || '');
      if (current.lastMessageDigest && (!savedLastDigest || savedLastDigest !== current.lastMessageDigest)) {
        return { needsUpdate: true, reason: savedLastDigest ? 'content_changed' : 'digest_missing', savedCount, currentCount: current.messageCount };
      }
      const savedAssetsDigest = String(contextData?.assetsDigest || assetsIndex?.summary?.assetsDigest || '');
      if (current.assetsDigest && (!savedAssetsDigest || savedAssetsDigest !== current.assetsDigest)) {
        return { needsUpdate: true, reason: savedAssetsDigest ? 'assets_changed' : 'assets_digest_missing', savedCount, currentCount: current.messageCount };
      }
      const path = workspaceName ? `${this.sanitizeFileName(workspaceName)}/${safeTitle}` : safeTitle;
      return { needsUpdate: false, reason: 'unchanged', savedCount, currentCount: current.messageCount, path };
    } catch {
      return { needsUpdate: true, reason: 'error', savedCount: 0 };
    }
  },

  async writeFile(folderHandle, fileName, content, type = 'text/plain') {
    const fileHandle = await folderHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(content instanceof Blob ? content : new Blob([content], { type }));
    await writable.close();
    return true;
  },

  buildPdfArtifacts(pdfOutput, baseName) {
    if (!pdfOutput) return [];
    if (pdfOutput instanceof Blob) return [{ fileName: `${baseName}.pdf`, blob: pdfOutput }];
    if (Array.isArray(pdfOutput)) {
      return pdfOutput.map((item, index) => {
        const blob = item?.blob instanceof Blob ? item.blob : (item instanceof Blob ? item : null);
        if (!blob) return null;
        const suffix = item?.nameSuffix || `part${String(index + 1).padStart(2, '0')}`;
        return { fileName: item?.fileName || `${baseName}_${suffix}.pdf`, blob };
      }).filter(Boolean);
    }
    if (Array.isArray(pdfOutput?.parts)) return this.buildPdfArtifacts(pdfOutput.parts, baseName);
    if (pdfOutput?.blob instanceof Blob) return [{ fileName: `${baseName}.pdf`, blob: pdfOutput.blob }];
    return [];
  },

  async saveConversation(conversationTitle, htmlContent, mdContent, pdfOutput, formats = { html: true, md: true, pdf: true }, workspaceName = null, jsonContent = null) {
    try {
      const folders = await this.createConversationFolders(conversationTitle, workspaceName);
      const fileName = folders.title;
      const results = { success: true, saved: [], splitPdfParts: [], folderState: await this.getFolderState() };
      if (formats.html && htmlContent) {
        await this.writeFile(folders.html, `${fileName}.html`, htmlContent, 'text/html');
        results.saved.push('html');
      }
      if (formats.md && mdContent) {
        await this.writeFile(folders.md, `${fileName}.md`, mdContent, 'text/markdown');
        results.saved.push('md');
      }
      if (formats.pdf && pdfOutput) {
        const pdfArtifacts = this.buildPdfArtifacts(pdfOutput, fileName);
        for (const artifact of pdfArtifacts) {
          await this.writeFile(folders.pdf, artifact.fileName, artifact.blob, 'application/pdf');
        }
        if (pdfArtifacts.length > 0) {
          results.saved.push('pdf');
          if (pdfArtifacts.length > 1) results.splitPdfParts = pdfArtifacts.map((artifact) => artifact.fileName);
        }
      }
      if (formats.json && jsonContent) {
        await this.writeFile(folders.json, `${fileName}.json`, jsonContent, 'application/json');
        results.saved.push('json');
      }
      results.title = folders.title;
      results.folderName = folders.folderName;
      results.workspaceName = folders.workspaceName;
      return results;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

const DownloadFallback = {
  async saveViaDownload(fileName, content, mimeType) {
    return new Promise((resolve, reject) => {
      const blob = content instanceof Blob ? content : new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      chrome.runtime.sendMessage({ action: 'download', url, filename: fileName }, (response) => {
        URL.revokeObjectURL(url);
        if (response && response.success) resolve(response);
        else reject(new Error(response?.error || '下载失败'));
      });
    });
  },

  async saveConversation(conversationTitle, htmlContent, mdContent, pdfOutput, formats = { html: true, md: true, pdf: true }, jsonContent = null) {
    const safeTitle = FileSystemManager.sanitizeFileName(conversationTitle);
    const timestamp = FileSystemManager.getTimestamp();
    const basePath = `ChatGPT-Backup/${safeTitle}_${timestamp}`;
    const results = { success: true, saved: [], title: safeTitle, splitPdfParts: [] };
    try {
      if (formats.html && htmlContent) {
        await this.saveViaDownload(`${basePath}/html/${safeTitle}.html`, htmlContent, 'text/html');
        results.saved.push('html');
      }
      if (formats.md && mdContent) {
        await this.saveViaDownload(`${basePath}/md/${safeTitle}.md`, mdContent, 'text/markdown');
        results.saved.push('md');
      }
      if (formats.pdf && pdfOutput) {
        const pdfArtifacts = FileSystemManager.buildPdfArtifacts(pdfOutput, safeTitle);
        for (const artifact of pdfArtifacts) {
          await this.saveViaDownload(`${basePath}/pdf/${artifact.fileName}`, artifact.blob, 'application/pdf');
        }
        if (pdfArtifacts.length > 0) {
          results.saved.push('pdf');
          if (pdfArtifacts.length > 1) results.splitPdfParts = pdfArtifacts.map((artifact) => artifact.fileName);
        }
      }
      if (formats.json && jsonContent) {
        await this.saveViaDownload(`${basePath}/json/${safeTitle}.json`, jsonContent, 'application/json');
        results.saved.push('json');
      }
      return results;
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};

if (typeof window !== 'undefined') {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.FileSystem = FileSystemManager;
  window.ChatGPTSaver.DownloadFallback = DownloadFallback;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FileSystemManager, DownloadFallback, FILE_SYSTEM_STORAGE_KEYS, FOLDER_STATE_DEFAULTS };
}
