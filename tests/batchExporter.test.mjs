// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ConversationModel } = require('../src/core/model.js');
const { BatchExporter, BATCH_STORAGE_KEY } = require('../src/core/batchExporter.js');

let dom = null;

function setupDom() {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://chatgpt.com/c/x' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.chrome = makeChromeMock();
  global.window.ChatGPTSaver = {
    ConversationModel,
    ChatGPTApiSource: makeApiMock(),
    FileSystem: makeFileSystemMock(),
    HTMLExporter: { exportConversation: vi.fn(() => '<html/>') },
    MarkdownExporter: { exportConversation: vi.fn(() => '# md') },
    JSONExporter: { exportFromConversation: vi.fn(() => ({})), serialize: vi.fn(() => '{}') }
  };
}

function makeChromeMock() {
  const store = {};
  return {
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          if (typeof keys === 'string') return { [keys]: store[keys] };
          if (Array.isArray(keys)) return keys.reduce((acc, k) => { acc[k] = store[k]; return acc; }, {});
          return store;
        }),
        set: vi.fn(async (obj) => { Object.assign(store, obj); })
      }
    },
    _store: store
  };
}

function makeApiMock() {
  return {
    listAllArray: vi.fn(async () => [
      { id: 'c1', title: 'A', update_time: 1700000000 },
      { id: 'c2', title: 'B', update_time: 1700000001 }
    ]),
    listAll: vi.fn(async function* () {
      yield { id: 'c1', title: 'A', update_time: 1700000000 };
      yield { id: 'c2', title: 'B', update_time: 1700000001 };
    }),
    fetchConversationAsModel: vi.fn(async (id) => ({
      platform: 'chatgpt',
      id,
      title: `Conv ${id}`,
      messages: [{ role: 'user', blocks: [ConversationModel.makeTextBlock({ role: 'user', text: 'hi' })] }]
    }))
  };
}

function makeFileSystemMock() {
  const saved = [];
  return {
    saveConversation: vi.fn(async (title, html, md, pdf, formats, ws, json) => {
      saved.push({ title, html, md, json });
      return { success: true };
    }),
    checkConversationNeedsUpdate: vi.fn(async () => ({ needsUpdate: true })),
    simpleHash: vi.fn((s) => 'hash:' + (s?.length || 0)),
    _saved: saved
  };
}

beforeEach(() => {
  setupDom();
  // reset BatchExporter internal state
  BatchExporter._state = null;
  BatchExporter._abortController = null;
  BatchExporter._running = false;
  BatchExporter._onProgressCallbacks.clear?.();
});

afterEach(() => {
  if (dom) dom.window.close();
  dom = null;
  global.chrome = undefined;
});

describe('BatchExporter.start - happy path', () => {
  it('exports all conversations via ChatGPTApiSource → FileSystem', async () => {
    const summary = await BatchExporter.start({
      conversations: [
        { id: 'c1', title: 'A' },
        { id: 'c2', title: 'B' }
      ],
      formats: { html: true, md: true, json: true, pdf: false },
      concurrency: 2,
      retry: 0
    });
    expect(summary.success).toBe(true);
    expect(summary.succeeded).toBe(2);
    expect(summary.failed).toBe(0);
    expect(window.ChatGPTSaver.FileSystem._saved.length).toBe(2);
    expect(window.ChatGPTSaver.FileSystem._saved[0].title).toMatch(/Conv c/);
  });

  it('persists progress to chrome.storage.local', async () => {
    await BatchExporter.start({
      conversations: [{ id: 'c1', title: 'X' }],
      formats: { html: true, md: false, json: false, pdf: false },
      concurrency: 1, retry: 0
    });
    const stored = chrome._store[BATCH_STORAGE_KEY];
    expect(stored).toBeTruthy();
    expect(stored.status).toBe('done');
    expect(stored.succeededIds).toContain('c1');
  });
});

describe('BatchExporter.start - retry on failure', () => {
  it('retries failed fetches with exponential backoff', async () => {
    let attempts = 0;
    window.ChatGPTSaver.ChatGPTApiSource.fetchConversationAsModel = vi.fn(async (id) => {
      attempts += 1;
      if (attempts < 3) throw new Error('rate_limit');
      return {
        platform: 'chatgpt',
        id,
        title: 'Recovered',
        messages: [{ role: 'user', blocks: [ConversationModel.makeTextBlock({ role: 'user', text: 'q' })] }]
      };
    });
    const summary = await BatchExporter.start({
      conversations: [{ id: 'rec', title: 'R' }],
      formats: { html: true, md: false, json: false, pdf: false },
      concurrency: 1, retry: 3
    });
    expect(summary.success).toBe(true);
    expect(summary.succeeded).toBe(1);
    expect(attempts).toBe(3);
  }, 30000);

  it('records failed items after exceeding retry', async () => {
    window.ChatGPTSaver.ChatGPTApiSource.fetchConversationAsModel = vi.fn(async () => {
      throw new Error('permanent');
    });
    const summary = await BatchExporter.start({
      conversations: [{ id: 'bad', title: 'B' }],
      formats: { html: true, md: false, json: false, pdf: false },
      concurrency: 1, retry: 1
    });
    expect(summary.success).toBe(true); // status==='done'，但 failed > 0
    expect(summary.failed).toBe(1);
  }, 30000);
});

describe('BatchExporter.abort', () => {
  it('signals abort and stops processing further items', async () => {
    let count = 0;
    window.ChatGPTSaver.ChatGPTApiSource.fetchConversationAsModel = vi.fn(async (id) => {
      count += 1;
      // 第一条慢，给我们时间 abort
      if (count === 1) {
        await new Promise((r) => setTimeout(r, 50));
        BatchExporter.abort();
      }
      return {
        platform: 'chatgpt',
        id,
        title: 'T',
        messages: [{ role: 'user', blocks: [ConversationModel.makeTextBlock({ role: 'user', text: 'q' })] }]
      };
    });
    const summary = await BatchExporter.start({
      conversations: [
        { id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }, { id: 'c5' }
      ],
      formats: { html: true, md: false, json: false, pdf: false },
      concurrency: 1, retry: 0
    });
    expect(summary.status).toBe('aborted');
  });
});

describe('BatchExporter.summarize', () => {
  it('computes percentages and totals', () => {
    const s = BatchExporter.summarize({
      runId: 'r1',
      status: 'running',
      pendingIds: ['a', 'b'],
      processing: ['c'],
      succeededIds: ['d', 'e'],
      skippedIds: ['f'],
      failedItems: [{ id: 'g', error: 'x' }]
    });
    expect(s.total).toBe(7);
    expect(s.done).toBe(4); // succeeded(2) + skipped(1) + failed(1)
    expect(s.pct).toBe(57);
  });
});
