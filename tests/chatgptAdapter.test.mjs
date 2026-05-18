// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { ConversationModel } = require('../src/core/model.js');
const { PlatformAdapterRegistry } = require('../src/adapters/_base.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const parserBrowserSrc = readFileSync(
  path.resolve(__dirname, '..', 'src', 'content', 'parser.js'),
  'utf8'
);
const adapterParserSrc = readFileSync(
  path.resolve(__dirname, '..', 'src', 'adapters', 'chatgpt', 'parser.js'),
  'utf8'
);
const adapterIndexSrc = readFileSync(
  path.resolve(__dirname, '..', 'src', 'adapters', 'chatgpt', 'index.js'),
  'utf8'
);

let dom = null;

function loadInDom(url) {
  dom = new JSDOM('<!doctype html><html><head><title>ChatGPT</title></head><body></body></html>', { url });
  global.window = dom.window;
  global.document = dom.window.document;
  global.window.ChatGPTSaver = {
    ConversationModel,
    PlatformAdapterRegistry
  };
  PlatformAdapterRegistry.reset();
  // 加载 parser（IIFE，挂 Parser 到 window）
  (new dom.window.Function('window', 'document', parserBrowserSrc))(dom.window, dom.window.document);
  // 重新挂 ConversationModel + Registry，因为 parser IIFE 内可能覆盖
  dom.window.ChatGPTSaver.ConversationModel = ConversationModel;
  dom.window.ChatGPTSaver.PlatformAdapterRegistry = PlatformAdapterRegistry;
  // 加载 adapter（同样 IIFE 注册到 window）
  (new dom.window.Function('window', 'document', adapterParserSrc))(dom.window, dom.window.document);
  (new dom.window.Function('window', 'document', adapterIndexSrc))(dom.window, dom.window.document);
}

beforeEach(() => loadInDom('https://chatgpt.com/c/test-conv-id'));

afterEach(() => {
  if (dom) dom.window.close();
  dom = null;
});

describe('ChatGPTAdapter registration', () => {
  it('registers chatgpt adapter to PlatformAdapterRegistry', () => {
    const reg = dom.window.ChatGPTSaver.PlatformAdapterRegistry;
    const adapter = reg.get('chatgpt');
    expect(adapter).toBeTruthy();
    expect(adapter.id).toBe('chatgpt');
  });

  it('hostMatches recognises chatgpt.com and chat.openai.com', () => {
    const adapter = dom.window.ChatGPTSaver.ChatGPTAdapter;
    expect(adapter.hostMatches('https://chatgpt.com/c/abc')).toBe(true);
    expect(adapter.hostMatches('https://chat.openai.com/c/abc')).toBe(true);
    expect(adapter.hostMatches('https://example.com/')).toBe(false);
  });

  it('getConversationId reads /c/{id} from path', () => {
    expect(dom.window.ChatGPTSaver.ChatGPTAdapter.getConversationId()).toBe('test-conv-id');
  });
});

describe('ChatGPTBlockExtractor.extractBlocks - advanced types', () => {
  it('parses thought details element as thought block', () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant">
        <div class="markdown prose">
          <details><summary>Thought for 8 seconds</summary><p>因为...所以...</p></details>
          <p>最终答案在这里。</p>
        </div>
      </div>
    `;
    const adapter = dom.window.ChatGPTSaver.ChatGPTAdapter;
    const model = adapter.parseConversationModel();
    expect(model.messages.length).toBe(1);
    const blocks = model.messages[0].blocks;
    const thought = blocks.find((b) => b.type === 'thought');
    expect(thought).toBeTruthy();
    expect(thought.summary).toContain('Thought');
    expect(thought.durationMs).toBe(8000);
    const text = blocks.find((b) => b.type === 'text');
    expect(text.text).toContain('最终答案');
  });

  it('parses canvas placeholder element', () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant">
        <div class="markdown prose">
          <button>Open canvas</button>
          <p>Canvas 已创建，详见右侧。</p>
        </div>
      </div>
      <aside><section data-canvas-id="cv-1"><h1>Story</h1><pre><code class="language-md">Once upon a time</code></pre></section></aside>
    `;
    const adapter = dom.window.ChatGPTSaver.ChatGPTAdapter;
    const model = adapter.parseConversationModel();
    const canvas = model.messages[0].blocks.find((b) => b.type === 'canvas');
    expect(canvas).toBeTruthy();
    expect(canvas.title).toBe('Story');
    expect(canvas.content).toContain('Once upon a time');
  });

  it('parses web search block', () => {
    document.body.innerHTML = `
      <div data-message-author-role="assistant">
        <div class="markdown prose">
          <details>
            <summary>Searching the web for "redis windows"</summary>
            <ol>
              <li><a href="https://redis.io/docs">Redis Docs</a><p class="snippet">Official documentation</p></li>
              <li><a href="https://github.com/microsoftarchive/redis">MS Redis</a></li>
            </ol>
          </details>
          <p>Based on the search...</p>
        </div>
      </div>
    `;
    const adapter = dom.window.ChatGPTSaver.ChatGPTAdapter;
    const model = adapter.parseConversationModel();
    const ws = model.messages[0].blocks.find((b) => b.type === 'web_search');
    expect(ws).toBeTruthy();
    expect(ws.sources.length).toBeGreaterThanOrEqual(2);
    expect(ws.sources[0].url).toBe('https://redis.io/docs');
    const text = model.messages[0].blocks.find((b) => b.type === 'text');
    expect(text.text).toContain('Based on');
  });

  it('falls back to text block when no advanced types present', () => {
    document.body.innerHTML = `
      <div data-message-author-role="user"><div class="whitespace-pre-wrap">hello there</div></div>
      <div data-message-author-role="assistant"><div class="markdown prose"><p>world!</p></div></div>
    `;
    const adapter = dom.window.ChatGPTSaver.ChatGPTAdapter;
    const model = adapter.parseConversationModel();
    expect(model.messages.length).toBe(2);
    model.messages.forEach((m) => {
      expect(m.blocks.every((b) => b.type === 'text')).toBe(true);
    });
  });
});
