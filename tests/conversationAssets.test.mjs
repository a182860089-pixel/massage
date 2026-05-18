import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ConversationAssets } = require('../src/utils/conversationAssets');

const originalWindow = global.window;
const originalDocument = global.document;
const originalLocation = global.location;
const originalFetch = global.fetch;

let dom = null;

beforeEach(() => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'https://chatgpt.com/c/123e4567-e89b-12d3-a456-426614174000'
  });

  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.fetch = vi.fn();

  window.ChatGPTSaver = {
    FileSystem: {
      ensureFolderReady: vi.fn(async () => ({ ready: true })),
      createConversationFolders: vi.fn(async () => ({ generated: {}, uploads: {} })),
      sanitizeFileName: (value) => String(value || '').trim() || 'untitled',
      writeFile: vi.fn(async () => {}),
      saveConversationContext: vi.fn(async () => ({ version: '2.1' })),
      upsertAssetEntries: vi.fn(async (_title, _workspace, _url, _kind, entries) => ({
        generated: entries,
        summary: { assetsDigest: 'digest' }
      }))
    },
    Parser: {
      parseConversation: () => ({
        title: '历史文件测试',
        url: window.location.href,
        messages: []
      }),
      getConversationTitle: () => '历史文件测试',
      getWorkspaceName: () => '个人帐户'
    },
    Logger: {
      add: vi.fn(),
      status: vi.fn()
    }
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  ConversationAssets._pendingGeneratedRequests = new Map();
  ConversationAssets._recentUploadKeys = new Map();
  ConversationAssets._memoryPendingUploads = new Map();
  ConversationAssets._pendingUploadDbPromise = null;
  ConversationAssets._bridgeBound = false;
  if (dom) {
    dom.window.close();
    dom = null;
  }
  global.window = originalWindow;
  global.document = originalDocument;
  global.location = originalLocation;
  global.fetch = originalFetch;
});

describe('ConversationAssets generated backfill diagnostics', () => {
  it('logs token failures with detailed reasons', async () => {
    vi.spyOn(ConversationAssets, 'requestGeneratedCandidates').mockResolvedValue({
      candidates: [{
        messageId: 'msg-generated-1',
        sandboxPath: '/mnt/data/report.csv',
        fileNameHint: 'report.csv'
      }],
      diagnostics: {
        scannedNodes: 1,
        candidateCount: 1,
        assistantMessages: 1,
        droppedMissingMessageId: 0,
        droppedMissingSandboxPath: 0
      }
    });
    vi.spyOn(ConversationAssets, 'fetchSessionToken').mockResolvedValue('');

    const result = await ConversationAssets.collectGeneratedFiles({ debug: true });

    expect(result.success).toBe(true);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].error).toBe('session_token_unavailable');
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('未拿到 /api/auth/session 的 accessToken'));
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('候选 1 获取下载地址失败：session_token_unavailable'));
  });

  it('logs bridge diagnostics when no generated candidates are found', async () => {
    vi.spyOn(ConversationAssets, 'requestGeneratedCandidates').mockResolvedValue({
      candidates: [],
      diagnostics: {
        scannedNodes: 3,
        candidateCount: 0,
        assistantMessages: 2,
        droppedMissingMessageId: 1,
        droppedMissingSandboxPath: 2
      }
    });

    const result = await ConversationAssets.collectGeneratedFiles({ debug: true });

    expect(result.success).toBe(true);
    expect(result.diagnostics.reason).toBe('no_candidates');
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('桥接扫描节点 3 个'));
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('未检测到可补抓的生成文件候选'));
  });

  it('downloads direct estuary content urls without interpreter resolution', async () => {
    const directUrl = 'https://chatgpt.com/backend-api/estuary/content?id=file_123456&ts=1&p=fs';
    vi.spyOn(ConversationAssets, 'requestGeneratedCandidates').mockResolvedValue({
      candidates: [{
        messageId: 'msg-generated-2',
        sandboxPath: directUrl,
        fileNameHint: ''
      }],
      diagnostics: {
        scannedNodes: 1,
        candidateCount: 1,
        assistantMessages: 1,
        droppedMissingMessageId: 0,
        droppedMissingSandboxPath: 0
      }
    });
    const tokenSpy = vi.spyOn(ConversationAssets, 'fetchSessionToken');
    global.fetch.mockResolvedValue({
      ok: true,
      url: directUrl,
      headers: {
        get: (name) => (String(name).toLowerCase() === 'content-disposition'
          ? 'attachment; filename="report.csv"'
          : null)
      },
      blob: async () => new Blob(['a,b\n1,2'], { type: 'text/csv' })
    });

    const result = await ConversationAssets.collectGeneratedFiles({ debug: true });

    expect(result.success).toBe(true);
    expect(result.saved).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.saved[0].name).toBe('report.csv');
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(directUrl, { credentials: 'include' });
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('本次候选均为直链文件地址'));
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('识别为直链文件地址，直接下载文件内容'));
  });

  it('collects historical uploads when download links are available', async () => {
    vi.spyOn(ConversationAssets, 'scanUploadCandidatesFromDOM').mockReturnValue({
      records: [{
        kind: 'upload',
        name: 'source.pdf',
        messageId: 'msg-upload-1',
        href: '/backend-api/files/source.pdf',
        source: 'dom_link',
        status: 'detected'
      }],
      diagnostics: {
        userMessages: 1,
        totalCandidates: 1,
        hrefCandidates: 1,
        textOnlyCandidates: 0
      }
    });
    vi.spyOn(ConversationAssets, 'requestGeneratedCandidates').mockResolvedValue({
      candidates: [],
      diagnostics: {
        scannedNodes: 0,
        candidateCount: 0,
        assistantMessages: 0,
        droppedMissingMessageId: 0,
        droppedMissingSandboxPath: 0
      }
    });
    global.fetch.mockResolvedValue({
      ok: true,
      url: 'https://chatgpt.com/backend-api/files/source.pdf',
      headers: {
        get: (name) => (String(name).toLowerCase() === 'content-disposition'
          ? 'attachment; filename="source.pdf"'
          : null)
      },
      blob: async () => new Blob(['pdf'], { type: 'application/pdf' })
    });

    const result = await ConversationAssets.collectConversationAssets({ debug: true });

    expect(result.success).toBe(true);
    expect(result.savedUploads).toHaveLength(1);
    expect(result.failedUploads).toHaveLength(0);
    expect(result.savedGenerated).toHaveLength(0);
    expect(global.fetch).toHaveBeenCalledWith('https://chatgpt.com/backend-api/files/source.pdf', { credentials: 'include' });
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('上传文件扫描：用户消息 1 条'));
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('上传候选 1 保存成功：source.pdf'));
  });

  it('marks text-only historical uploads as missing download links', async () => {
    vi.spyOn(ConversationAssets, 'scanUploadCandidatesFromDOM').mockReturnValue({
      records: [{
        kind: 'upload',
        name: 'source.docx',
        messageId: 'msg-upload-2',
        href: '',
        source: 'dom_text',
        status: 'missing_original'
      }],
      diagnostics: {
        userMessages: 1,
        totalCandidates: 1,
        hrefCandidates: 0,
        textOnlyCandidates: 1
      }
    });
    vi.spyOn(ConversationAssets, 'requestGeneratedCandidates').mockResolvedValue({
      candidates: [],
      diagnostics: {
        scannedNodes: 0,
        candidateCount: 0,
        assistantMessages: 0,
        droppedMissingMessageId: 0,
        droppedMissingSandboxPath: 0
      }
    });

    const result = await ConversationAssets.collectConversationAssets({ debug: true });

    expect(result.success).toBe(true);
    expect(result.savedUploads).toHaveLength(0);
    expect(result.failedUploads).toHaveLength(1);
    expect(result.failedUploads[0].error).toBe('missing_download_link');
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('页面里只有文件名，没有可下载链接'));
  });

  it('hydrates text-only upload candidates from conversation api metadata', async () => {
    vi.spyOn(ConversationAssets, 'scanUploadCandidatesFromDOM').mockReturnValue({
      records: [{
        kind: 'upload',
        name: 'source.docx',
        messageId: 'msg-upload-3',
        href: '',
        source: 'dom_text',
        status: 'missing_original'
      }],
      diagnostics: {
        userMessages: 1,
        totalCandidates: 1,
        hrefCandidates: 0,
        textOnlyCandidates: 1
      }
    });
    vi.spyOn(ConversationAssets, 'fetchHistoricalUploadCandidates').mockResolvedValue({
      records: [{
        kind: 'upload',
        name: 'source.docx',
        messageId: 'msg-upload-3',
        href: '/backend-api/files/source.docx',
        fileId: 'file_123abc',
        source: 'conversation_api',
        status: 'detected'
      }],
      diagnostics: {
        reason: 'ok',
        totalCandidates: 1,
        hrefCandidates: 1,
        fileIdCandidates: 1
      }
    });
    vi.spyOn(ConversationAssets, 'requestGeneratedCandidates').mockResolvedValue({
      candidates: [],
      diagnostics: {
        scannedNodes: 0,
        candidateCount: 0,
        assistantMessages: 0,
        droppedMissingMessageId: 0,
        droppedMissingSandboxPath: 0
      }
    });
    global.fetch.mockResolvedValue({
      ok: true,
      url: 'https://chatgpt.com/backend-api/files/source.docx',
      headers: {
        get: (name) => (String(name).toLowerCase() === 'content-disposition'
          ? 'attachment; filename="source.docx"'
          : null)
      },
      blob: async () => new Blob(['docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    });

    const result = await ConversationAssets.collectConversationAssets({ debug: true, historicalProbe: true });

    expect(result.success).toBe(true);
    expect(result.savedUploads).toHaveLength(1);
    expect(result.failedUploads).toHaveLength(0);
    expect(global.fetch).toHaveBeenCalledWith('https://chatgpt.com/backend-api/files/source.docx', { credentials: 'include' });
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('会话接口上传元数据：识别 1 个，可下载链接 1 个，fileId 1 个，状态 ok'));
  });

  it('probes fileId endpoints when upload metadata has fileId but no direct url', async () => {
    vi.spyOn(ConversationAssets, 'scanUploadCandidatesFromDOM').mockReturnValue({
      records: [{
        kind: 'upload',
        name: 'source.docx',
        messageId: 'msg-upload-4',
        href: '',
        fileId: 'file_987xyz',
        source: 'dom_text',
        status: 'missing_original'
      }],
      diagnostics: {
        userMessages: 1,
        totalCandidates: 1,
        hrefCandidates: 0,
        textOnlyCandidates: 1
      }
    });
    vi.spyOn(ConversationAssets, 'fetchHistoricalUploadCandidates').mockResolvedValue({
      records: [{
        kind: 'upload',
        name: 'source.docx',
        messageId: 'msg-upload-4',
        href: '',
        fileId: 'file_987xyz',
        source: 'conversation_api',
        status: 'missing_original'
      }],
      diagnostics: {
        reason: 'ok',
        totalCandidates: 1,
        hrefCandidates: 0,
        fileIdCandidates: 1
      }
    });
    vi.spyOn(ConversationAssets, 'requestGeneratedCandidates').mockResolvedValue({
      candidates: [],
      diagnostics: {
        scannedNodes: 0,
        candidateCount: 0,
        assistantMessages: 0,
        droppedMissingMessageId: 0,
        droppedMissingSandboxPath: 0
      }
    });
    vi.spyOn(ConversationAssets, 'fetchSessionToken').mockResolvedValue('token-value');
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ download_url: 'https://chatgpt.com/files/source.docx' })
      })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://chatgpt.com/files/source.docx',
        headers: {
          get: (name) => (String(name).toLowerCase() === 'content-disposition'
            ? 'attachment; filename="source.docx"'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        },
        blob: async () => new Blob(['docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      });

    const result = await ConversationAssets.collectConversationAssets({ debug: true, historicalProbe: true });

    expect(result.success).toBe(true);
    expect(result.savedUploads).toHaveLength(1);
    expect(result.failedUploads).toHaveLength(0);
    expect(global.fetch).toHaveBeenNthCalledWith(1, 'https://chatgpt.com/backend-api/files/file_987xyz/download', {
      credentials: 'include',
      headers: { authorization: 'Bearer token-value' }
    });
    expect(global.fetch).toHaveBeenNthCalledWith(2, 'https://chatgpt.com/files/source.docx', {
      credentials: 'include',
      headers: { authorization: 'Bearer token-value' }
    });
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('开始使用 fileId 反查下载源'));
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('fileId 反查成功：files_download 提供了下载地址'));
  });

  it('uses message_id-aware fileId probe when plain download returns 422', async () => {
    vi.spyOn(ConversationAssets, 'scanUploadCandidatesFromDOM').mockReturnValue({
      records: [{
        kind: 'upload',
        name: 'source.docx',
        messageId: 'msg-upload-5',
        href: '',
        fileId: 'file_555abc',
        source: 'dom_text',
        status: 'missing_original'
      }],
      diagnostics: {
        userMessages: 1,
        totalCandidates: 1,
        hrefCandidates: 0,
        textOnlyCandidates: 1
      }
    });
    vi.spyOn(ConversationAssets, 'fetchHistoricalUploadCandidates').mockResolvedValue({
      records: [{
        kind: 'upload',
        name: 'source.docx',
        messageId: 'msg-upload-5',
        href: '',
        fileId: 'file_555abc',
        source: 'conversation_api',
        status: 'missing_original'
      }],
      diagnostics: {
        reason: 'ok',
        totalCandidates: 1,
        hrefCandidates: 0,
        fileIdCandidates: 1
      }
    });
    vi.spyOn(ConversationAssets, 'requestGeneratedCandidates').mockResolvedValue({
      candidates: [],
      diagnostics: {
        scannedNodes: 0,
        candidateCount: 0,
        assistantMessages: 0,
        droppedMissingMessageId: 0,
        droppedMissingSandboxPath: 0
      }
    });
    vi.spyOn(ConversationAssets, 'fetchSessionToken').mockResolvedValue('token-value');
    global.fetch
      .mockResolvedValueOnce({
        ok: false,
        status: 422,
        headers: { get: () => 'application/json' }
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: { get: () => 'application/json' }
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        headers: { get: () => 'application/octet-stream' }
      })
      .mockResolvedValueOnce({
        ok: true,
        headers: { get: () => 'application/json' },
        json: async () => ({ signed_url: 'https://chatgpt.com/files/source-from-message.docx' })
      })
      .mockResolvedValueOnce({
        ok: true,
        url: 'https://chatgpt.com/files/source-from-message.docx',
        headers: {
          get: (name) => (String(name).toLowerCase() === 'content-disposition'
            ? 'attachment; filename="source-from-message.docx"'
            : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        },
        blob: async () => new Blob(['docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
      });

    const result = await ConversationAssets.collectConversationAssets({ debug: true, historicalProbe: true });

    expect(result.success).toBe(true);
    expect(result.savedUploads).toHaveLength(1);
    expect(result.failedUploads).toHaveLength(0);
    expect(global.fetch).toHaveBeenNthCalledWith(4, 'https://chatgpt.com/backend-api/files/file_555abc/download?message_id=msg-upload-5', {
      credentials: 'include',
      headers: { authorization: 'Bearer token-value' }
    });
    expect(window.ChatGPTSaver.Logger.add).toHaveBeenCalledWith(expect.stringContaining('files_download_with_message 提供了下载地址'));
  });

  it('stages realtime uploads when folder access is not ready and flushes them later', async () => {
    window.ChatGPTSaver.FileSystem.ensureFolderReady = vi
      .fn()
      .mockResolvedValueOnce({ ready: false })
      .mockResolvedValueOnce({ ready: true })
      .mockResolvedValueOnce({ ready: true });

    const file = new window.File(['hello world'], 'draft.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      lastModified: 1700000000000
    });

    const captureResult = await ConversationAssets.captureUploadedFiles([file], {
      source: 'input_change',
      reason: 'capture_upload'
    });

    expect(captureResult.success).toBe(true);
    expect(captureResult.saved).toHaveLength(0);
    expect(captureResult.stagedCount).toBe(1);
    expect(captureResult.pendingCount).toBe(1);
    expect(window.ChatGPTSaver.FileSystem.writeFile).not.toHaveBeenCalled();

    const flushResult = await ConversationAssets.flushPendingUploads({ reason: 'manual_folder_pick' });

    expect(flushResult.success).toBe(true);
    expect(flushResult.flushedCount).toBe(1);
    expect(flushResult.pendingCount).toBe(0);
    expect(window.ChatGPTSaver.FileSystem.writeFile).toHaveBeenCalledTimes(1);
    expect(window.ChatGPTSaver.FileSystem.upsertAssetEntries).toHaveBeenCalled();
  });

  it('keeps realtime uploads pending until the conversation title becomes available', async () => {
    window.ChatGPTSaver.Parser.parseConversation = () => ({
      title: '',
      url: window.location.href,
      messages: []
    });
    window.ChatGPTSaver.Parser.getConversationTitle = () => '';

    const file = new window.File(['later title'], 'pending.txt', {
      type: 'text/plain',
      lastModified: 1700000000001
    });

    const captureResult = await ConversationAssets.captureUploadedFiles([file], {
      source: 'input_change',
      reason: 'capture_upload'
    });

    expect(captureResult.success).toBe(true);
    expect(captureResult.saved).toHaveLength(0);
    expect(captureResult.stagedCount).toBe(1);
    expect(captureResult.pendingCount).toBe(1);

    window.ChatGPTSaver.Parser.parseConversation = () => ({
      title: '标题已恢复',
      url: window.location.href,
      messages: []
    });
    window.ChatGPTSaver.Parser.getConversationTitle = () => '标题已恢复';

    const flushResult = await ConversationAssets.flushPendingUploads({ reason: 'url_change' });

    expect(flushResult.success).toBe(true);
    expect(flushResult.flushedCount).toBe(1);
    expect(flushResult.pendingCount).toBe(0);
    expect(window.ChatGPTSaver.FileSystem.writeFile).toHaveBeenCalledTimes(1);
  });
});
