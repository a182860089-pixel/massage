import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { FileSystemManager, DownloadFallback } = require('../src/utils/fileSystem');

class FakeFileHandle {
  constructor(name, content = '') {
    this.kind = 'file';
    this.name = name;
    this._content = content;
  }

  async getFile() {
    return {
      name: this.name,
      text: async () => this._content
    };
  }

  async createWritable() {
    return {
      write: async (value) => {
        if (value instanceof Blob) this._content = await value.text();
        else this._content = String(value);
      },
      close: async () => {}
    };
  }
}

class FakeDirectoryHandle {
  constructor(name) {
    this.kind = 'directory';
    this.name = name;
    this.map = new Map();
  }

  async getDirectoryHandle(name, options = {}) {
    const existing = this.map.get(name);
    if (existing && existing.kind === 'directory') return existing;
    if (options.create) {
      const next = new FakeDirectoryHandle(name);
      this.map.set(name, next);
      return next;
    }
    throw new Error(`Missing directory: ${name}`);
  }

  async getFileHandle(name, options = {}) {
    const existing = this.map.get(name);
    if (existing && existing.kind === 'file') return existing;
    if (options.create) {
      const next = new FakeFileHandle(name);
      this.map.set(name, next);
      return next;
    }
    throw new Error(`Missing file: ${name}`);
  }
}

const originalChrome = global.chrome;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  global.chrome = {
    runtime: {
      sendMessage: vi.fn((payload, callback) => callback({ success: true, payload }))
    }
  };
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  global.chrome = originalChrome;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  FileSystemManager.rootHandle = null;
  FileSystemManager.folderState = null;
});

describe('FileSystemManager', () => {
  it('sanitizes empty names, reserved names and trailing dots', () => {
    expect(FileSystemManager.sanitizeFileName('')).toBe('untitled');
    expect(FileSystemManager.sanitizeFileName('CON')).toBe('CON_');
    expect(FileSystemManager.sanitizeFileName('report.')).toBe('report');
  });

  it('detects content changes when message count stays the same', async () => {
    const root = new FakeDirectoryHandle('root');
    const backup = await root.getDirectoryHandle(FileSystemManager.backupFolderName, { create: true });
    const workspace = await backup.getDirectoryHandle('Workspace', { create: true });
    const conversation = await workspace.getDirectoryHandle('Conversation', { create: true });
    const contextFolder = await conversation.getDirectoryHandle('context', { create: true });
    const ctxFile = await contextFolder.getFileHandle('Conversation.json', { create: true });
    ctxFile._content = JSON.stringify({
      messageCount: 2,
      lastMessageDigest: 'old-digest',
      assetsDigest: 'same-assets'
    });

    FileSystemManager.rootHandle = root;
    const result = await FileSystemManager.checkConversationNeedsUpdate('Conversation', 'Workspace', {
      messageCount: 2,
      lastMessageDigest: 'new-digest',
      assetsDigest: 'same-assets'
    });

    expect(result.needsUpdate).toBe(true);
    expect(result.reason).toBe('content_changed');
  });
});

describe('FileSystemManager folder persistence (regression for "picker keeps popping up")', () => {
  function makeHandle({ permission = 'granted', folderName = 'ChatGPT-Backup' } = {}) {
    return {
      name: 'ChatGPTBackup',
      kind: 'directory',
      queryPermission: vi.fn(async () => permission),
      requestPermission: vi.fn(async () => permission),
      getDirectoryHandle: vi.fn(async () => ({ name: folderName, kind: 'directory' }))
    };
  }

  it('_verifyHandle returns permission_required + handle when querying yields prompt', async () => {
    const handle = makeHandle({ permission: 'prompt' });
    const result = await FileSystemManager._verifyHandle(handle, { interactive: false });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe('permission_required');
    expect(result.handle).toBe(handle);
  });

  it('ensureFolderReady does NOT clearSavedHandle when restored handle only needs permission', async () => {
    const handle = makeHandle({ permission: 'prompt' });
    const clearSpy = vi.spyOn(FileSystemManager, 'clearSavedHandle');
    const restoreSpy = vi.spyOn(FileSystemManager, 'restoreHandleFromIndexedDB').mockResolvedValue(handle);
    const supportSpy = vi.spyOn(FileSystemManager, 'isFileSystemAccessSupported').mockReturnValue(true);

    const result = await FileSystemManager.ensureFolderReady({ interactive: false, reason: 'test' });

    expect(result.ready).toBe(false);
    expect(result.reason).toBe('stale');
    expect(clearSpy).not.toHaveBeenCalled();
    expect(FileSystemManager.rootHandle).toBe(handle);

    restoreSpy.mockRestore();
    clearSpy.mockRestore();
    supportSpy.mockRestore();
  });

  it('restorePermission elevates the in-memory handle to granted without opening picker', async () => {
    let perm = 'prompt';
    const handle = {
      name: 'ChatGPTBackup',
      kind: 'directory',
      queryPermission: vi.fn(async () => perm),
      requestPermission: vi.fn(async () => {
        perm = 'granted';
        return 'granted';
      }),
      getDirectoryHandle: vi.fn(async () => ({ name: 'ChatGPT-Backup', kind: 'directory' }))
    };
    FileSystemManager.rootHandle = handle;
    const supportSpy = vi.spyOn(FileSystemManager, 'isFileSystemAccessSupported').mockReturnValue(true);

    const result = await FileSystemManager.restorePermission();

    expect(result.success).toBe(true);
    expect(handle.requestPermission).toHaveBeenCalledTimes(1);
    expect(FileSystemManager.rootHandle).toBe(handle);

    supportSpy.mockRestore();
  });
});

describe('DownloadFallback', () => {
  it('saves JSON in download fallback mode', async () => {
    const result = await DownloadFallback.saveConversation(
      'Conversation',
      '<html></html>',
      '# Title',
      null,
      { html: false, md: false, pdf: false, json: true },
      '{"ok":true}'
    );

    expect(result.success).toBe(true);
    expect(result.saved).toEqual(['json']);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage.mock.calls[0][0].filename).toContain('/json/Conversation.json');
  });
});
