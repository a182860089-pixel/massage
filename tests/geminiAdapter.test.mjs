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

const parserSrc = readFileSync(
  path.resolve(__dirname, '..', 'src', 'adapters', 'gemini', 'parser.js'),
  'utf8'
);
const indexSrc = readFileSync(
  path.resolve(__dirname, '..', 'src', 'adapters', 'gemini', 'index.js'),
  'utf8'
);

let dom = null;

function loadInDom(url) {
  dom = new JSDOM('<!doctype html><html><head><title>Gemini</title></head><body></body></html>', { url });
  global.window = dom.window;
  global.document = dom.window.document;
  global.window.ChatGPTSaver = { ConversationModel, PlatformAdapterRegistry };
  PlatformAdapterRegistry.reset();
  (new dom.window.Function('window', 'document', parserSrc))(dom.window, dom.window.document);
  (new dom.window.Function('window', 'document', indexSrc))(dom.window, dom.window.document);
}

beforeEach(() => loadInDom('https://gemini.google.com/app/abc123'));

afterEach(() => {
  if (dom) dom.window.close();
  dom = null;
});

describe('GeminiAdapter registration', () => {
  it('registers gemini adapter', () => {
    const reg = dom.window.ChatGPTSaver.PlatformAdapterRegistry;
    const adapter = reg.get('gemini');
    expect(adapter).toBeTruthy();
    expect(adapter.id).toBe('gemini');
  });

  it('hostMatches recognises gemini.google.com only', () => {
    const adapter = dom.window.ChatGPTSaver.GeminiAdapter;
    expect(adapter.hostMatches('https://gemini.google.com/app')).toBe(true);
    expect(adapter.hostMatches('https://chatgpt.com/')).toBe(false);
  });

  it('reads conversation id from /app/<id>', () => {
    expect(dom.window.ChatGPTSaver.GeminiAdapter.getConversationId()).toBe('abc123');
  });
});

describe('GeminiAdapter.parseConversationModel', () => {
  it('extracts user + model turns from ms-chat-turn', () => {
    document.body.innerHTML = `
      <ms-chat-turn author="user">
        <div data-test-id="user-prompt-text">什么是 Gemini？</div>
      </ms-chat-turn>
      <ms-chat-turn author="model">
        <ms-thought-chunk>
          <h3>Thinking</h3>
          <p>用户在问产品基础信息</p>
        </ms-thought-chunk>
        <div data-test-id="model-response-text">
          <p>Gemini 是 Google 的多模态大模型。</p>
        </div>
      </ms-chat-turn>
    `;
    const adapter = dom.window.ChatGPTSaver.GeminiAdapter;
    const model = adapter.parseConversationModel();
    expect(model.platform).toBe('gemini');
    expect(model.messages.length).toBe(2);
    expect(model.messages[0].role).toBe('user');
    expect(model.messages[0].blocks[0].text).toContain('什么是 Gemini');
    expect(model.messages[1].role).toBe('assistant');
    const thought = model.messages[1].blocks.find((b) => b.type === 'thought');
    expect(thought).toBeTruthy();
    expect(thought.detailsText).toContain('产品基础信息');
    const text = model.messages[1].blocks.find((b) => b.type === 'text');
    expect(text.text).toContain('Gemini 是 Google');
  });

  it('infers role from data-test-id when author attr missing', () => {
    document.body.innerHTML = `
      <ms-chat-turn>
        <div data-test-id="user-prompt-container">
          <div data-test-id="user-prompt-text">hi</div>
        </div>
      </ms-chat-turn>
      <ms-chat-turn>
        <div data-test-id="model-response-text">hello!</div>
      </ms-chat-turn>
    `;
    const adapter = dom.window.ChatGPTSaver.GeminiAdapter;
    const model = adapter.parseConversationModel();
    expect(model.messages[0].role).toBe('user');
    expect(model.messages[1].role).toBe('assistant');
  });

  it('falls back to ms-autosize-textarea data-value', () => {
    document.body.innerHTML = `
      <ms-chat-turn author="user">
        <ms-autosize-textarea data-value="re-edited prompt"></ms-autosize-textarea>
      </ms-chat-turn>
    `;
    const adapter = dom.window.ChatGPTSaver.GeminiAdapter;
    const model = adapter.parseConversationModel();
    expect(model.messages.length).toBe(1);
    expect(model.messages[0].blocks[0].text).toContain('re-edited prompt');
  });
});
