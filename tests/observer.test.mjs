// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const observerPath = path.resolve(__dirname, '..', 'src', 'content', 'observer.js');
const source = readFileSync(observerPath, 'utf8');

let URLObserver;
let ConversationObserver;

function setupParserStub({ container, messages = [], typing = false, hash = 'h0' }) {
  window.ChatGPTSaver = window.ChatGPTSaver || {};
  window.ChatGPTSaver.Parser = {
    getConversationContainer: () => container,
    getMessageElements: () => messages,
    isGPTTyping: () => typing,
    getContentHash: () => hash
  };
}

beforeEach(() => {
  // 每个 case 全新加载 observer.js，避免单例残留
  delete window.ChatGPTSaver;
  const fn = new Function('window', 'document', source + '\nreturn window.ChatGPTSaver;');
  const saver = fn(window, document);
  URLObserver = saver.URLObserver;
  ConversationObserver = saver.Observer;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ConversationObserver', () => {
  it('isActive starts as false', () => {
    expect(ConversationObserver.isActive()).toBe(false);
  });

  it('start sets isWatching when container is found and stops cleanly', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    setupParserStub({ container });

    ConversationObserver.start(() => {});
    expect(ConversationObserver.isActive()).toBe(true);

    ConversationObserver.stop();
    expect(ConversationObserver.isActive()).toBe(false);
    expect(ConversationObserver.previousHash).toBeNull();
    expect(ConversationObserver.lastMessageCount).toBe(0);
  });

  it('repeated start triggers an internal stop (no duplicate observers leak)', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    setupParserStub({ container });

    ConversationObserver.start(() => {});
    const firstObserver = ConversationObserver.observer;
    ConversationObserver.start(() => {});
    const secondObserver = ConversationObserver.observer;
    expect(firstObserver).not.toBe(secondObserver);
    ConversationObserver.stop();
  });

  it('reset clears state without stopping the observer', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    setupParserStub({ container });
    ConversationObserver.start(() => {});
    ConversationObserver.previousHash = 'something';
    ConversationObserver.lastMessageCount = 5;
    ConversationObserver.reset();
    expect(ConversationObserver.previousHash).toBeNull();
    expect(ConversationObserver.lastMessageCount).toBe(0);
    expect(ConversationObserver.isActive()).toBe(true);
    ConversationObserver.stop();
  });
});

describe('URLObserver', () => {
  // 注意：URLObserver.start() 会注册 popstate 监听器、整个 document.body 的 MutationObserver
  // 以及 1s setInterval，且不提供 stop()。直接调用 start 会污染后续测试。
  // 因此这里直接手动注入内部状态测试 checkURLChange。

  it('fires callback when URL changes', () => {
    const calls = [];
    URLObserver.lastURL = window.location.href;
    URLObserver.onChangeCallback = (url) => calls.push(url);

    history.pushState({}, '', '/conversations/abc');
    URLObserver.checkURLChange();
    expect(calls.at(-1)).toContain('/conversations/abc');

    history.pushState({}, '', '/');
    URLObserver.checkURLChange();
    expect(calls.at(-1)).toMatch(/\/$/);
  });

  it('does not fire callback when URL is unchanged', () => {
    URLObserver.lastURL = window.location.href;
    const cb = vi.fn();
    URLObserver.onChangeCallback = cb;
    URLObserver.checkURLChange();
    expect(cb).not.toHaveBeenCalled();
  });

  it('post-fix: stop() is now defined and clears internal state', () => {
    expect(typeof URLObserver.stop).toBe('function');
  });

  it('post-fix: repeated start() is idempotent (does not stack popstate listeners / timers)', () => {
    URLObserver.start(() => {});
    const firstPoll = URLObserver._pollTimer;
    URLObserver.start(() => {});
    const secondPoll = URLObserver._pollTimer;
    expect(firstPoll).not.toBe(secondPoll);
    URLObserver.stop();
    expect(URLObserver._pollTimer).toBeNull();
    expect(URLObserver._mutationObserver).toBeNull();
    expect(URLObserver._popstateListener).toBeNull();
  });
});
